import { GitContentsProvider } from "./git-contents-provider.js";

export class GitHubProvider extends GitContentsProvider {
  constructor(config) {
    super("github", config, {
      apiBase: "https://api.github.com",
      authScheme: "Bearer",
      accept: "application/vnd.github+json"
    });
  }
}
