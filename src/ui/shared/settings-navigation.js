export async function openConnectionSettings(api = chrome) {
  const url = api.runtime.getURL("src/ui/options/options.html#settings");
  await api.tabs.create({ url, active: true });
}
