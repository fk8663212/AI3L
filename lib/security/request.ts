import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).origin;
  } catch {
    return null;
  }
}

/**
 * Origins this deployment legitimately answers on: the host the request was
 * actually sent to (so Preview URLs, per-deployment *.vercel.app URLs and
 * custom domains all work), plus the configured app URL and Vercel's own
 * deployment, branch and production hostnames.
 */
export function allowedOrigins(request: Request): Set<string> {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || url.host;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  return new Set(
    [
      originOf(`${proto}://${host}`),
      url.origin,
      originOf(process.env.NEXT_PUBLIC_APP_URL),
      originOf(process.env.VERCEL_URL),
      originOf(process.env.VERCEL_BRANCH_URL),
      originOf(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    ].filter((origin): origin is string => Boolean(origin)),
  );
}

/**
 * CSRF guard for cookie-authenticated POSTs: a browser always sends the
 * page's real Origin on cross-site requests, so a request whose Origin is not
 * one of this deployment's own origins came from another site.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (!allowedOrigins(request).has(origin)) {
    throw new ApiError(403, "ORIGIN_MISMATCH", "不允許的請求來源。");
  }
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "輸入資料格式不正確，請檢查後再試。",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  console.error("Unhandled API error", error);
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "伺服器發生錯誤，請稍後再試。",
      },
    },
    { status: 500 },
  );
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
