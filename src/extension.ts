// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import { Logger } from "./services/logging/Logger"
import { createClineAPI } from "./exports"
import "./utils/path" // necessary to have access to String.prototype.toPosix
import { DIFF_VIEW_URI_SCHEME } from "./integrations/editor/DiffViewProvider"
import assert from "node:assert"
import { posthogClientProvider } from "./services/posthog/PostHogClientProvider"
import { WebviewProvider } from "./core/webview"
import { Controller } from "./core/controller"
import { ErrorService } from "./services/error/ErrorService"
import { initializeTestMode, cleanupTestMode } from "./services/test/TestMode"
import { telemetryService } from "./services/posthog/telemetry/TelemetryService"

/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

let outputChannel: vscode.OutputChannel

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel("Companion")
	context.subscriptions.push(outputChannel)

	ErrorService.initialize()
	Logger.initialize(outputChannel)
	Logger.log("Companion extension activated")

	const sidebarWebview = new WebviewProvider(context, outputChannel)

	// Initialize test mode and add disposables to context
	context.subscriptions.push(...initializeTestMode(context, sidebarWebview.controller))

	vscode.commands.executeCommand("setContext", "companion.isDevMode", IS_DEV && IS_DEV === "true")

	// Sidebar view provider registration removed

	// Create a panel in the rightmost side by default
	const openCompanionPanel = async () => {
		Logger.log("Opening Companion panel in rightmost side")
		const panel = vscode.window.createWebviewPanel(
			WebviewProvider.tabPanelId,
			"Companion",
			vscode.ViewColumn.Beside, // Opens in the rightmost column
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [context.extensionUri],
			},
		)

		panel.iconPath = {
			light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_light.png"),
			dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "robot_panel_dark.png"),
		}

		const panelProvider = new WebviewProvider(context, outputChannel)
		await panelProvider.resolveWebviewView(panel)

		// Lock the editor group so clicking on files doesn't replace the panel
		await setTimeoutPromise(100)
		await vscode.commands.executeCommand("workbench.action.lockEditorGroup")
	}

	// Open the panel by default when extension activates
	openCompanionPanel()

	// Register the open panel command - always opens the panel
	context.subscriptions.push(
		vscode.commands.registerCommand("companion.openPanel", async () => {
			// Close any existing panel instances first
			WebviewProvider.closeAllTabInstances()

			// Open a new panel
			await openCompanionPanel()
		}),
	)

	// Register the toggle panel command - toggles the panel on/off
	context.subscriptions.push(
		vscode.commands.registerCommand("companion.togglePanel", async () => {
			// Get all tab instances
			const tabInstances = WebviewProvider.getTabInstances()

			// If there are tab instances, dispose them
			if (tabInstances.length > 0) {
				WebviewProvider.closeAllTabInstances()
			} else {
				// Open a new panel
				await openCompanionPanel()
			}
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("companion.plusButtonClicked", async (webview: any) => {
			const openChat = async (instance?: WebviewProvider) => {
				await instance?.controller.clearTask()
				await instance?.controller.postStateToWebview()
				await instance?.controller.postMessageToWebview({
					type: "action",
					action: "chatButtonClicked",
				})
			}
			WebviewProvider.getTabInstances().forEach(openChat)
		}),
	)

	/*
	We use the text document content provider API to show the left side for diff view by creating a virtual document for the original content. This makes it readonly so users know to edit the right side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by claiming an uri-scheme for which your provider then returns text contents. The scheme must be provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents given such an uri. In return, content providers are wired into the open document logic so that providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))

	// URI Handler
	const handleUri = async (uri: vscode.Uri) => {
		console.log("URI Handler called with:", {
			path: uri.path,
			query: uri.query,
			scheme: uri.scheme,
		})

		const path = uri.path
		const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
		const visibleWebview = WebviewProvider.getVisibleInstance()
		if (!visibleWebview) {
			return
		}
		switch (path) {
			case "/openrouter": {
				const code = query.get("code")
				if (code) {
					await visibleWebview?.controller.handleOpenRouterCallback(code)
				}
				break
			}
			case "/auth": {
				const token = query.get("token")
				const state = query.get("state")
				const apiKey = query.get("apiKey")

				console.log("Auth callback received:", {
					token: token,
					state: state,
					apiKey: apiKey,
				})

				// Validate state parameter
				if (!(await visibleWebview?.controller.validateAuthState(state))) {
					vscode.window.showErrorMessage("Invalid auth state")
					return
				}

				if (token && apiKey) {
					await visibleWebview?.controller.handleAuthCallback(token, apiKey)
				}
				break
			}
			default:
				break
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	// Register size testing commands in development mode
	if (IS_DEV && IS_DEV === "true") {
		// Use dynamic import to avoid loading the module in production
		import("./dev/commands/tasks")
			.then((module) => {
				const devTaskCommands = module.registerTaskCommands(context, sidebarWebview.controller)
				context.subscriptions.push(...devTaskCommands)
				Logger.log("Companion dev task commands registered")
			})
			.catch((error) => {
				Logger.log("Failed to register dev task commands: " + error)
			})
	}

	// Register code action provider
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			"*",
			new (class implements vscode.CodeActionProvider {
				public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix]

				provideCodeActions(
					document: vscode.TextDocument,
					range: vscode.Range,
					context: vscode.CodeActionContext,
				): vscode.CodeAction[] {
					// Expand range to include surrounding 3 lines
					const expandedRange = new vscode.Range(
						Math.max(0, range.start.line - 3),
						0,
						Math.min(document.lineCount - 1, range.end.line + 3),
						document.lineAt(Math.min(document.lineCount - 1, range.end.line + 3)).text.length,
					)

					const addAction = new vscode.CodeAction("Add to Companion", vscode.CodeActionKind.QuickFix)
					addAction.command = {
						command: "companion.addToChat",
						title: "Add to Companion",
						arguments: [expandedRange, context.diagnostics],
					}

					const fixAction = new vscode.CodeAction("Fix with Companion", vscode.CodeActionKind.QuickFix)
					fixAction.command = {
						command: "companion.fixWithCompanion",
						title: "Fix with Companion",
						arguments: [expandedRange, context.diagnostics],
					}

					// Only show actions when there are errors
					if (context.diagnostics.length > 0) {
						return [addAction, fixAction]
					} else {
						return []
					}
				}
			})(),
			{
				providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
			},
		),
	)

	return createClineAPI(outputChannel, sidebarWebview.controller)
}

// TODO: Find a solution for automatically removing DEV related content from production builds.
//  This type of code is fine in production to keep. We just will want to remove it from production builds
//  to bring down built asset sizes.
//
// This is a workaround to reload the extension when the source code changes
// since vscode doesn't support hot reload for extensions
const { IS_DEV, DEV_WORKSPACE_FOLDER } = process.env

// This method is called when your extension is deactivated
export async function deactivate() {
	await telemetryService.sendCollectedEvents()

	// Clean up test mode
	cleanupTestMode()
	await posthogClientProvider.shutdown()
	Logger.log("Companion extension deactivated")
}

// Set up development mode file watcher
if (IS_DEV && IS_DEV !== "false") {
	assert(DEV_WORKSPACE_FOLDER, "DEV_WORKSPACE_FOLDER must be set in development")
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, "src/**/*"))

	watcher.onDidChange(({ scheme, path }) => {
		console.info(`${scheme} ${path} changed. Reloading VSCode...`)

		vscode.commands.executeCommand("workbench.action.reloadWindow")
	})
}
