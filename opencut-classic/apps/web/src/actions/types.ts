import type { MutableRefObject } from "react";
import { ACTIONS, type TAction } from "./definitions";

export type { TAction };

export type TActionArgsMap = {
	"seek-forward": { seconds: number } | undefined;
	"seek-backward": { seconds: number } | undefined;
	"jump-forward": { seconds: number } | undefined;
	"jump-backward": { seconds: number } | undefined;
	"remove-media-asset": { projectId: string; assetId: string };
	"remove-media-assets": { projectId: string; assetIds: string[] };
};

type TKeysWithValueUndefined<T> = {
	[K in keyof T]: undefined extends T[K] ? K : never;
}[keyof T];

export type TActionWithArgs = keyof TActionArgsMap;

export type TActionWithOptionalArgs =
	| TActionWithNoArgs
	| TKeysWithValueUndefined<TActionArgsMap>;

export type TActionWithNoArgs = Exclude<TAction, TActionWithArgs>;

const ACTION_SET: ReadonlySet<string> = new Set(Object.keys(ACTIONS));

// Keep in sync with TActionArgsMap above: these are the only entries whose
// value type does *not* include `| undefined`, i.e. the only actions
// TActionWithOptionalArgs excludes.
const REQUIRED_ARG_ACTIONS: ReadonlySet<string> = new Set([
	"remove-media-asset",
	"remove-media-assets",
] satisfies TActionWithArgs[]);

export function isActionWithOptionalArgs(
	value: string,
): value is TActionWithOptionalArgs {
	return ACTION_SET.has(value) && !REQUIRED_ARG_ACTIONS.has(value);
}

export type TArgOfAction<A extends TAction> = A extends TActionWithArgs
	? TActionArgsMap[A]
	: undefined;

export type TActionFunc<A extends TAction> = A extends TActionWithArgs
	? (arg: TArgOfAction<A>, trigger?: TInvocationTrigger) => void
	: (_?: undefined, trigger?: TInvocationTrigger) => void;

export type TInvocationTrigger = "keypress" | "mouseclick";

export type TBoundActionList = {
	[A in TAction]?: Array<TActionFunc<A>>;
};

export type TActionHandlerOptions =
	| MutableRefObject<boolean>
	| boolean
	| undefined;
