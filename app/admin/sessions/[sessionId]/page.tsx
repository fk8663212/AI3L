import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  FullSessionLearningRecord,
  ReadonlyStudentSession,
} from "@/components/admin/session-readonly";
import { SessionPrintControls } from "@/components/admin/session-print-controls";
import { ApiError } from "@/lib/security/request";
import { getAdminClaims } from "@/lib/security/session";
import {
  getAdminSessionLearningRecord,
  getAdminSessionMeta,
  type AdminSessionViewMode,
} from "@/lib/services/admin-session-service";
import { getSessionView } from "@/lib/services/session-service";

const sessionIdSchema = z.string().uuid();

function parameter(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { sessionId } = await params;
  const query = await searchParams;
  const mode = parameter(query.mode) === "full" ? "full" : "student";
  return {
    title: `ai3l-session-${sessionId.slice(0, 8)}-${mode}`,
  };
}

async function loadSessionPageData(
  sessionId: string,
  mode: AdminSessionViewMode,
) {
  if (mode === "full") {
    return {
      mode,
      record: await getAdminSessionLearningRecord(sessionId),
    } as const;
  }
  const [session, view] = await Promise.all([
    getAdminSessionMeta(sessionId),
    getSessionView(sessionId, {
      artifactUrl: (artifactId) =>
        `/api/admin/sessions/${sessionId}/artifacts/${artifactId}`,
    }),
  ]);
  return { mode, session, view } as const;
}

export default async function AdminSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await getAdminClaims())) redirect("/admin/login");
  const parsedId = sessionIdSchema.safeParse((await params).sessionId);
  if (!parsedId.success) notFound();
  const sessionId = parsedId.data;
  const query = await searchParams;
  const mode: AdminSessionViewMode =
    parameter(query.mode) === "full" ? "full" : "student";
  const autoPrint = parameter(query.print) === "1";

  let data: Awaited<ReturnType<typeof loadSessionPageData>>;
  try {
    data = await loadSessionPageData(sessionId, mode);
  } catch (error) {
    if (error instanceof ApiError && error.code === "SESSION_NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  if (data.mode === "full") {
    return (
      <main className="session-preview-page">
        <SessionPrintControls
          sessionId={sessionId}
          mode={data.mode}
          autoPrint={autoPrint}
        />
        <FullSessionLearningRecord record={data.record} />
      </main>
    );
  }

  return (
    <main className="session-preview-page">
      <SessionPrintControls
        sessionId={sessionId}
        mode={data.mode}
        autoPrint={autoPrint}
      />
      <ReadonlyStudentSession view={data.view} session={data.session} />
    </main>
  );
}
