PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_price_tiers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`product_unit_id` integer NOT NULL,
	`min_qty` integer NOT NULL,
	`max_qty` integer,
	`harga_jual` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Every tier that exists today is implicitly base-unit-scoped (there was nowhere
-- else to point it), so each one lands on its product's base row. max_qty starts
-- NULL, which reads as "open-ended above min_qty" - exactly the old behaviour.
-- The join is LEFT on purpose: 0007 gives every product a base row, so a miss
-- means that invariant broke, and hitting the NOT NULL here aborts the migration
-- instead of silently dropping a product's pricing.
INSERT INTO `__new_product_price_tiers` (`id`, `product_id`, `product_unit_id`, `min_qty`, `max_qty`, `harga_jual`, `created_at`, `updated_at`)
SELECT t.id, t.product_id, pu.id, t.min_qty, NULL, t.harga_jual, t.created_at, t.updated_at
FROM product_price_tiers t
LEFT JOIN product_units pu ON pu.product_id = t.product_id AND pu.is_base_unit = 1;--> statement-breakpoint
DROP TABLE `product_price_tiers`;--> statement-breakpoint
ALTER TABLE `__new_product_price_tiers` RENAME TO `product_price_tiers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `product_price_tiers_product_unit_id_min_qty_unique` ON `product_price_tiers` (`product_unit_id`,`min_qty`);
