import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "motods",
    time: new Date().toISOString(),
  });
}
