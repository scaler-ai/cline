import ClineLogoVariable from "@/assets/ClineLogoVariable"
import HeroTooltip from "@/components/common/HeroTooltip"

const HomeHeader = () => {
	return (
		<div className="flex flex-col items-center mb-5">
			<div className="my-5">
				<ClineLogoVariable className="size-16" />
			</div>
			<div className="text-center flex-col items-center justify-center">
				<h2 className="m-0 text-[var(--vscode-font-size)]">{"I am your Scaler Companion."}</h2>
				<br />
				<h3 className="m-0 text-[var(--vscode-font-size)]">
					{"Let me know in case you need any help solving the problem! 2.1.27"}
				</h3>
				{/* <HeroTooltip
					placement="bottom"
					className="max-w-[300px]"
					content={
						"I can develop software step-by-step by editing files, exploring projects, running commands, and using browsers. I can even extend my capabilities with MCP tools to assist beyond basic code completion."
					}>
					<span
						className="codicon codicon-info ml-2 cursor-pointer"
						style={{ fontSize: "14px", color: "var(--vscode-textLink-foreground)" }}
					/>
				</HeroTooltip> */}
			</div>
		</div>
	)
}

export default HomeHeader
