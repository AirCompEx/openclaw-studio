import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerStudioBasePath, withStudioBasePath } from "@/lib/studio/base-path";

/** Signs the user out and clears the session cookies. */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const { origin } = new URL(request.url);
  return NextResponse.redirect(
    `${origin}${withStudioBasePath("/login", resolveServerStudioBasePath())}`,
    { status: 303 }
  );
}
