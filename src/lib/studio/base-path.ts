export type StudioPublicConfig = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  studioBasePath?: string;
};

type EnvLike = Record<string, string | undefined>;

export const normalizeStudioBasePath = (value: unknown): string => {
  if (typeof value !== "string") return "";
  let normalized = value.trim();
  if (!normalized || normalized === "/") return "";
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

export const resolveServerStudioBasePath = (env: EnvLike = process.env): string =>
  normalizeStudioBasePath(env.STUDIO_BASE_PATH);

export const readStudioPublicConfig = (): StudioPublicConfig => {
  if (typeof window === "undefined") return {};
  return (
    (window as unknown as { __STUDIO_PUBLIC_CONFIG__?: StudioPublicConfig })
      .__STUDIO_PUBLIC_CONFIG__ ?? {}
  );
};

export const resolveClientStudioBasePath = (): string =>
  normalizeStudioBasePath(readStudioPublicConfig().studioBasePath);

export const withStudioBasePath = (href: string, basePath = ""): string => {
  const normalizedBasePath = normalizeStudioBasePath(basePath);
  const normalizedHref = href.trim();
  if (!normalizedBasePath || !normalizedHref.startsWith("/")) return normalizedHref;
  if (
    normalizedHref === normalizedBasePath ||
    normalizedHref.startsWith(`${normalizedBasePath}/`)
  ) {
    return normalizedHref;
  }
  if (normalizedHref === "/") return `${normalizedBasePath}/`;
  return `${normalizedBasePath}${normalizedHref}`;
};
