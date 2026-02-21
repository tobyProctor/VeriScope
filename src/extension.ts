import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

type OpenLocationMessage = {
  type: "openLocation";
  payload: {
    file?: string;
    line?: number;
    column?: number;
  };
};

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand("blockDiagram.openSchematic", async () => {
    let xmlBaseDir = "";

    const panel = vscode.window.createWebviewPanel(
      "blockDiagram.schematic",
      "Block Diagram Schematic",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.webview.html = await buildWebviewHtml(context, panel.webview);

    panel.webview.onDidReceiveMessage(async (msg: OpenLocationMessage) => {
      if (msg?.type !== "openLocation") {
        return;
      }
      await openLocationFromMessage(msg.payload, xmlBaseDir);
    });

    try {
      const loaded = await loadConfiguredXmlText();
      xmlBaseDir = path.dirname(loaded.resolvedPath);
      panel.webview.postMessage({ type: "loadXml", payload: { xmlText: loaded.xmlText } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(message);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // no-op
}

async function buildWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): Promise<string> {
  const viewerPath = path.join(context.extensionPath, "media", "viewer.html");
  const raw = await fs.readFile(viewerPath, "utf8");
  let html = raw;

  // Inject a lightweight CSP that allows d3 and inline script/style used by the existing viewer.
  const csp = [
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    "script-src 'unsafe-inline' https://cdn.jsdelivr.net"
  ].join("; ");

  html = html.replace("</head>", `  <meta http-equiv=\"Content-Security-Policy\" content=\"${csp}\">\n</head>`);
  return html;
}

async function loadConfiguredXmlText(): Promise<{ xmlText: string; resolvedPath: string }> {
  const config = vscode.workspace.getConfiguration("blockDiagram");
  let configuredPath = String(config.get<string>("xmlPath") || "").trim();

  if (!configuredPath) {
    const pick = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { XML: ["xml"] },
      openLabel: "Select Verilator XML"
    });

    if (!pick || !pick.length) {
      throw new Error("No XML file selected. Set blockDiagram.xmlPath in Settings to skip this prompt.");
    }

    configuredPath = pick[0].fsPath;
    await config.update("xmlPath", configuredPath, vscode.ConfigurationTarget.Workspace);
  }

  const resolved = resolveInputPath(configuredPath);
  try {
    const xmlText = await fs.readFile(resolved, "utf8");
    return { xmlText, resolvedPath: resolved };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read XML from \"${resolved}\": ${detail}`);
  }
}

function resolveInputPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    return path.resolve(inputPath);
  }

  return path.resolve(ws.uri.fsPath, inputPath);
}

async function openLocationFromMessage(
  payload: { file?: string; line?: number; column?: number },
  xmlBaseDir: string
) {
  const rawFile = String(payload.file || "").trim();
  if (!rawFile) {
    void vscode.window.showWarningMessage("No source file was provided for this module.");
    return;
  }

  const sourceRoot = getConfiguredSourceRoot();
  const resolvedFile = await resolveWorkspaceFile(rawFile, xmlBaseDir, sourceRoot);
  if (!resolvedFile) {
    void vscode.window.showWarningMessage(`Could not resolve source file: ${rawFile}`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedFile));
  const editor = await vscode.window.showTextDocument(doc, { preview: false });

  const line = Math.max(0, Number.isFinite(payload.line) ? Number(payload.line) - 1 : 0);
  const col = Math.max(0, Number.isFinite(payload.column) ? Number(payload.column) - 1 : 0);

  const pos = new vscode.Position(line, col);
  const range = new vscode.Range(pos, pos);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function getConfiguredSourceRoot(): string {
  const configured = String(vscode.workspace.getConfiguration("blockDiagram").get<string>("sourceRoot") || "").trim();
  if (!configured) {
    return "";
  }
  return resolveInputPath(configured);
}

async function resolveWorkspaceFile(fileFromXml: string, xmlBaseDir: string, sourceRoot: string): Promise<string | null> {
  if (path.isAbsolute(fileFromXml)) {
    try {
      await fs.access(fileFromXml);
      return fileFromXml;
    } catch {
      return null;
    }
  }

  if (sourceRoot) {
    const candidate = path.resolve(sourceRoot, fileFromXml);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  const workspaces = vscode.workspace.workspaceFolders || [];
  for (const ws of workspaces) {
    const candidate = path.resolve(ws.uri.fsPath, fileFromXml);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  if (xmlBaseDir) {
    const candidate = path.resolve(xmlBaseDir, fileFromXml);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  // Final fallback: search by basename anywhere in the workspace.
  const base = path.basename(fileFromXml);
  if (base) {
    const matches = await vscode.workspace.findFiles(`**/${base}`, "**/{node_modules,.git,out}/**", 20);
    if (matches.length > 0) {
      // Prefer exact suffix matches when XML includes subfolders (e.g. rtl/top.sv).
      const normalizedNeedle = fileFromXml.replaceAll("\\", "/");
      const exact = matches.find((m) => m.fsPath.replaceAll("\\", "/").endsWith(normalizedNeedle));
      if (exact) {
        return exact.fsPath;
      }
      return matches[0].fsPath;
    }
  }

  return null;
}
