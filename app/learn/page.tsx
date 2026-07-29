import { redirect } from "next/navigation";
import { ChatWorkspace } from "@/components/student/chat-workspace";
import { getStudentClaims } from "@/lib/security/session";
import { getSessionView } from "@/lib/services/session-service";

export default async function LearnPage() {
  const claims = await getStudentClaims();
  if (!claims) redirect("/");
  const view = await getSessionView(claims.sessionId);
  return <ChatWorkspace initialView={view} />;
}
