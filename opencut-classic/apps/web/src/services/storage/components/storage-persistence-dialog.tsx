"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useStoragePersistence } from "@/services/storage/use-storage-persistence";

export function StoragePersistenceDialog() {
	const { showDialog, onConfirm, onDismiss } = useStoragePersistence();

	return (
		<Dialog open={showDialog} onOpenChange={(open) => !open && onDismiss()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Não perca seus projetos</DialogTitle>
				</DialogHeader>
				<DialogBody>
					<p className="text-base text-muted-foreground">
						O armazenamento pode apagar seus projetos automaticamente quando o espaço acabar.
					</p>
					<p className="text-base text-muted-foreground">
						Permitir que o OpenCut os proteja?
					</p>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={onDismiss}>
						Agora não
					</Button>
					<Button onClick={onConfirm}>Permitir</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
