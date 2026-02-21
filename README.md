# Block Diagram VS Code Extension (Prototype)

This repo now contains a VS Code extension that opens the Verilator XML schematic in a webview and lets you click modules to jump to source.

## Features

- Command: `Block Diagram: Open Schematic`
- Setting: `blockDiagram.xmlPath`
- Setting: `blockDiagram.sourceRoot`
- Opens the XML in a webview using `media/viewer.html`
- Clicking a module in the diagram sends source location info to the extension
- Extension opens the corresponding source file in another editor tab and reveals line/column

## Setup

1. Install dependencies:

```bash
npm install
```

2. Build:

```bash
npm run compile
```

3. Launch the extension in VS Code:
- Open this folder in VS Code.
- Press `F5` (Run Extension).
- In the Extension Development Host, run command palette action:
  - `Block Diagram: Open Schematic`

## XML Path Configuration

Set `blockDiagram.xmlPath` in workspace settings, for example:

```json
{
  "blockDiagram.xmlPath": "build/Vtop.xml",
  "blockDiagram.sourceRoot": "rtl"
}
```

If not set, the command prompts you to pick an XML file and writes that path to workspace settings.

## Notes

- Source jump relies on `loc` fields in the Verilator XML and matching `<files>/<module_files>` entries.
- Relative source paths are resolved against:
  1. `blockDiagram.sourceRoot` (if set)
  2. workspace folder root(s)
  3. the XML file directory
