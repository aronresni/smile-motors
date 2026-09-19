/**
 * Alta administrativa de un usuario (Auth + perfil interno).
 *
 * NO contiene credenciales. Lee de variables de entorno:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Uso (la contraseña se pasa por argumento, no se persiste):
 *   node --env-file=.env.local supabase/scripts/create-user.mjs \
 *     --email persona@empresa.com --password "TEMPORAL" --role seller --name "Nombre Apellido"
 *
 * Idempotente: si el usuario ya existe, actualiza contraseña/metadata.
 * El perfil lo crea el trigger `handle_new_user` a partir de user_metadata.role;
 * si no apareciera, este script lo inserta.
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    role: { type: "string", default: "seller" },
    name: { type: "string", default: "" },
  },
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!values.email || !values.password) {
  console.error("Uso: --email <correo> --password <temporal> [--role seller|admin] [--name 'Nombre']");
  process.exit(1);
}
if (!["seller", "admin"].includes(values.role)) {
  console.error(`role inválido: ${values.role}`);
  process.exit(1);
}

const email = values.email.trim().toLowerCase();
const { password, role, name } = values;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- 1. Crear o localizar el usuario de Auth ---------------------------------
const { data: list, error: listErr } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listErr) throw listErr;

let authUser = list.users.find((u) => u.email?.toLowerCase() === email);

if (authUser) {
  console.log(`· Usuario de Auth ya existe: ${authUser.id} — actualizando`);
  const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
    password,
    email_confirm: true,
    user_metadata: { ...authUser.user_metadata, full_name: name, role },
  });
  if (error) throw error;
  authUser = data.user;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, role },
  });
  if (error) throw error;
  authUser = data.user;
  console.log(`· Usuario de Auth creado: ${authUser.id}`);
}

// --- 2. Asegurar el perfil interno -----------------------------------------
await new Promise((r) => setTimeout(r, 600)); // margen para el trigger

let { data: profile } = await admin
  .from("profiles")
  .select("*")
  .eq("id", authUser.id)
  .single();

if (!profile) {
  const { data, error } = await admin
    .from("profiles")
    .insert({ id: authUser.id, email, full_name: name, role, is_active: true })
    .select("*")
    .single();
  if (error) throw error;
  profile = data;
  console.log("· Perfil insertado manualmente");
} else {
  console.log("· Perfil creado por el trigger handle_new_user");
}

if (profile.role !== role || profile.is_active !== true) {
  console.warn("!! El perfil tiene valores inesperados:", profile);
  console.warn(
    "   (protect_profile_privileged_columns impide que el service_role cambie role/is_active;",
  );
  console.warn("    ajusta con SQL como postgres si hiciera falta.)");
}

// --- 3. Verificación: login + RLS con la clave anon (como la app) ----------
const pub = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: signIn, error: signInErr } = await pub.auth.signInWithPassword({
  email,
  password,
});

const report = {
  authUserId: authUser.id,
  authEmail: authUser.email,
  emailConfirmed: Boolean(authUser.email_confirmed_at ?? authUser.confirmed_at),
  profileId: profile.id,
  profileEmail: profile.email,
  profileLinkedToAuth: profile.id === authUser.id,
  role: profile.role,
  isActive: profile.is_active,
  fullName: profile.full_name,
  loginVerified: false,
  rlsSelfRowVisible: false,
  rlsForeignRowsVisible: null,
  isAdminRpc: null,
  userRoleRpc: null,
};

if (signInErr) {
  console.error("· LOGIN FALLÓ:", signInErr.message);
} else {
  report.loginVerified = signIn.user.id === authUser.id;

  const { data: rlsRows } = await pub
    .from("profiles")
    .select("id, email, role, is_active");
  report.rlsSelfRowVisible = Boolean(
    rlsRows?.some((r) => r.id === authUser.id),
  );
  report.rlsForeignRowsVisible = (rlsRows ?? []).filter(
    (r) => r.id !== authUser.id,
  ).length;

  const { data: isAdmin } = await pub.rpc("is_admin");
  const { data: userRole } = await pub.rpc("user_role");
  report.isAdminRpc = isAdmin;
  report.userRoleRpc = userRole;

  await pub.auth.signOut();
}

console.log("\n=== REPORTE ===");
console.log(JSON.stringify(report, null, 2));
