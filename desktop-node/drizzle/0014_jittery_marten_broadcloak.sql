CREATE TABLE `purchase_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_id` integer NOT NULL,
	`user_id` integer,
	`jumlah` integer NOT NULL,
	`tanggal` text NOT NULL,
	`keterangan` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `purchases` ADD `dibayar` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Every purchase recorded before this migration was entered as goods arriving, with no
-- notion of payment, and the shop treated them as settled. Leaving the new column at 0
-- would invent a debt for each one, so they are backfilled as paid in full; only
-- purchases entered from here on can carry a real BON.
UPDATE `purchases` SET `dibayar` = `total`;