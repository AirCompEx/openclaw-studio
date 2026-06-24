import { redirect } from "next/navigation";

import { resolveServerStudioBasePath, withStudioBasePath } from "@/lib/studio/base-path";

export default function InvalidRoutePage() {
  redirect(withStudioBasePath("/", resolveServerStudioBasePath()));
}
