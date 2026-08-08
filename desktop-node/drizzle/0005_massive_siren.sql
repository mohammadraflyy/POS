PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`satuan` text NOT NULL,
	`jumlah_kemasan` integer NOT NULL,
	`konversi` integer NOT NULL,
	`harga_jual` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_product_units`("id", "product_id", "satuan", "jumlah_kemasan", "konversi", "harga_jual", "created_at", "updated_at") SELECT "id", "product_id", "satuan", "jumlah_kemasan", "konversi", "harga_jual", "created_at", "updated_at" FROM `product_units`;--> statement-breakpoint
DROP TABLE `product_units`;--> statement-breakpoint
ALTER TABLE `__new_product_units` RENAME TO `product_units`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `product_units_product_id_satuan_unique` ON `product_units` (`product_id`,`satuan`);