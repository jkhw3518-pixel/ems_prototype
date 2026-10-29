import { handler, type P } from "@/lib/api";
import { testChannel } from "@/lib/alerts/evaluate";

export const POST = handler<P<"id">>(async (_req, db, { params }) => testChannel(db, Number((await params).id)));
