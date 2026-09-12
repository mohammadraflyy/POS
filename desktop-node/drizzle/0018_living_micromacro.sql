CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nama` text NOT NULL,
	`telepon` text,
	`alamat` text,
	`keterangan` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `sales` ADD `customer_id` integer REFERENCES customers(id) ON DELETE set null;--> statement-breakpoint
INSERT INTO `customers` (`nama`, `created_at`, `updated_at`)
SELECT max(trim(`nama_pelanggan`)), CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM `sales`
WHERE `nama_pelanggan` IS NOT NULL AND trim(`nama_pelanggan`) <> ''
GROUP BY lower(trim(`nama_pelanggan`));--> statement-breakpoint
UPDATE `sales` SET `customer_id` = (SELECT `id` FROM `customers` WHERE lower(`customers`.`nama`) = lower(trim(`sales`.`nama_pelanggan`)))
WHERE `nama_pelanggan` IS NOT NULL AND trim(`nama_pelanggan`) <> '';