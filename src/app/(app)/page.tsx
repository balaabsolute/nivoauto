import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth";
import { homePathFor } from "@/domain/permissions";

export default async function Home() {
  redirect(homePathFor(await requireActor()));
}
