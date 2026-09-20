"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/toast";
import {
  NOTIFICATION_COLUMNS,
  toNotificationItem,
  type NotificationItem,
  type NotificationRow,
} from "@/lib/notifications/types";

const RECENT_LIMIT = 12;

/** Orden de la base: más reciente primero (desempate por id). */
function byNewest(a: NotificationItem, b: NotificationItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

interface NotificationsContextValue {
  zone: "admin" | "seller";
  unread: number;
  /** Recientes para la campana (`null` = aún no cargadas). */
  recent: NotificationItem[] | null;
  loadingRecent: boolean;
  /** Sube con cada notificación en vivo: las páginas pueden refrescarse. */
  version: number;
  /** Canal Realtime suscrito (las notificaciones llegan en vivo). */
  live: boolean;
  loadRecent: () => Promise<void>;
  /** Marca leída (si hace falta) y navega a su destino. */
  open: (item: NotificationItem) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications fuera de <NotificationsProvider>");
  return ctx;
}

/**
 * Estado de notificaciones del usuario autenticado + Realtime.
 *
 * Seguridad: el canal se filtra por `recipient_user_id`, pero la frontera real
 * es RLS (`notifications_select_own`), que Realtime aplica por suscriptor: un
 * vendedor nunca recibe filas de otro aunque manipule el filtro.
 */
export function NotificationsProvider({
  userId,
  zone,
  initialUnread,
  children,
}: {
  userId: string;
  zone: "admin" | "seller";
  initialUnread: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [unread, setUnread] = useState(initialUnread);
  const [recent, setRecent] = useState<NotificationItem[] | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [version, setVersion] = useState(0);
  const [live, setLive] = useState(false);
  const recentLoaded = useRef(false);
  // La base es la autoridad: el contador SIEMPRE sale de ella y, si hay varias
  // lecturas en vuelo, solo vale la última (nunca un +1 local que pueda
  // sumarse dos veces con una reconciliación).
  const countSeq = useRef(0);
  const recentSeq = useRef(0);
  // Un toast por notificación, y solo para las que llegan EN VIVO (las que
  // se recuperan de la base al conectar no interrumpen).
  const toasted = useRef(new Set<string>());

  const refreshCount = useCallback(async () => {
    const seq = ++countSeq.current;
    const { data, error } = await supabase.rpc("notification_unread_count");
    if (seq !== countSeq.current) return;
    if (!error && typeof data === "number") setUnread(data);
  }, [supabase]);

  const loadRecent = useCallback(async () => {
    const seq = ++recentSeq.current;
    setLoadingRecent(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select(NOTIFICATION_COLUMNS)
        .eq("recipient_user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(RECENT_LIMIT);
      if (seq !== recentSeq.current) return;
      if (!error) {
        setRecent(((data ?? []) as NotificationRow[]).map(toNotificationItem));
        recentLoaded.current = true;
      }
    } finally {
      setLoadingRecent(false);
    }
  }, [supabase, userId]);

  // Realtime: INSERT → toast + contador + lista; UPDATE (leída en otra
  // pestaña) → reconciliar el contador.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const filter = `recipient_user_id=eq.${userId}`;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter },
          (payload) => {
            const item = toNotificationItem(payload.new as NotificationRow);
            void refreshCount();
            setRecent((list) =>
              list
                ? [item, ...list.filter((x) => x.id !== item.id)].sort(byNewest).slice(0, RECENT_LIMIT)
                : list,
            );
            setVersion((v) => v + 1);
            if (!toasted.current.has(item.id)) {
              toasted.current.add(item.id);
              toast.notify(item.title, item.context ?? item.message, item.destinationUrl ?? undefined);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter },
          (payload) => {
            const row = payload.new as NotificationRow;
            setRecent((list) =>
              list ? list.map((x) => (x.id === row.id ? { ...x, readAt: row.read_at } : x)) : list,
            );
            void refreshCount();
          },
        )
        .subscribe((status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            setLive(true);
            // Lo que llegó entre el render del servidor y la suscripción no
            // se repite por Realtime: se reconcilia desde la base.
            void refreshCount();
            if (recentLoaded.current) void loadRecent();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setLive(false);
          }
        });
    })();

    // Si la pestaña estuvo en segundo plano (o se cortó la conexión), al
    // volver se reconcilia el contador desde la base.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshCount();
        if (recentLoaded.current) void loadRecent();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, userId, refreshCount, loadRecent]);

  const open = useCallback(
    async (item: NotificationItem) => {
      if (!item.readAt) {
        const readAt = new Date().toISOString();
        setRecent((list) => (list ? list.map((x) => (x.id === item.id ? { ...x, readAt } : x)) : list));
        setUnread((n) => Math.max(0, n - 1));
        const seq = ++countSeq.current;
        const { data } = await supabase.rpc("notification_mark_read", { p_notification_id: item.id });
        const res = data as { ok?: boolean; unread?: number } | null;
        if (seq === countSeq.current && res?.ok && typeof res.unread === "number") setUnread(res.unread);
      }
      if (item.destinationUrl) router.push(item.destinationUrl);
      else router.refresh();
    },
    [supabase, router],
  );

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    setRecent((list) => (list ? list.map((x) => (x.readAt ? x : { ...x, readAt })) : list));
    setUnread(0);
    ++countSeq.current; // invalida lecturas de contador en vuelo
    await supabase.rpc("notification_mark_all_read");
    router.refresh();
  }, [supabase, router]);

  const value = useMemo<NotificationsContextValue>(
    () => ({ zone, unread, recent, loadingRecent, version, live, loadRecent, open, markAllRead }),
    [zone, unread, recent, loadingRecent, version, live, loadRecent, open, markAllRead],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
