export function formatDate({ date }: { date: Date }): string {
	return date.toLocaleDateString("pt-BR", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}
