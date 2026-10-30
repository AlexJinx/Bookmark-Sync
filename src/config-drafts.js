export function applyProviderDrafts(
  currentConfig,
  { activeProvider, activeDraft, drafts = {}, providerKeys = [], settings = {} }
) {
  const mergedDrafts = {
    ...drafts,
    [activeProvider]: activeDraft
  };
  const nextConfig = {
    ...currentConfig,
    ...settings,
    provider: activeProvider
  };

  for (const provider of providerKeys) {
    if (!mergedDrafts[provider]) {
      continue;
    }
    nextConfig[provider] = {
      ...currentConfig[provider],
      ...mergedDrafts[provider]
    };
  }

  return nextConfig;
}
