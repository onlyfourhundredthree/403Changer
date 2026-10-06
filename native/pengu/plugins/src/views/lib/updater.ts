// 403Changer ships its own updater (the launcher), so the loader never checks
// GitHub for upstream Pengu Loader releases and never shows an update prompt.
export interface LoaderUpdate {
  old: string;
  version: string;
  changelog: string;
}

export async function fetchUpdate(): Promise<LoaderUpdate | false> {
  return false;
}
