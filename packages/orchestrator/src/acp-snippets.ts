import type { IdeProfile, WorkspaceConfig } from "@voice-dev-agent/contracts";

export interface AcpSnippet {
  editor: IdeProfile;
  title: string;
  content: string;
}

export function buildAcpSnippets(workspace: WorkspaceConfig, gatewayUrl: string, token?: string): AcpSnippet[] {
  const args = ["acp", "--session", workspace.defaultSessionKey, "--url", gatewayUrl];
  if (token) {
    args.push("--token", token);
  }

  const joinedArgs = args.map((arg) => `"${arg}"`).join(", ");

  const zedSnippet = `{
  "agent_servers": {
    "OpenClaw ACP (${workspace.id})": {
      "type": "custom",
      "command": "openclaw",
      "args": [${joinedArgs}],
      "env": {}
    }
  }
}`;

  const genericSnippet = `openclaw acp --session ${workspace.defaultSessionKey} --url ${gatewayUrl}${
    token ? ` --token ${token}` : ""
  }`;

  return [
    {
      editor: "zed",
      title: "Zed settings.json snippet",
      content: zedSnippet
    },
    {
      editor: "generic",
      title: "Generic ACP command",
      content: genericSnippet
    }
  ];
}
