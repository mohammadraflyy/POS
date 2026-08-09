-- Top-up units from any satuan created after 0006 ran (same idempotent statement as 0006).
-- The joins below drop rows whose satuan has no units row, so units must be complete first.
INSERT INTO units (code, name, symbol, is_active, created_at, updated_at)
SELECT UPPER(TRIM(satuan)), MIN(TRIM(satuan)), LOWER(MIN(TRIM(satuan))), 1, unixepoch(), unixepoch()
FROM (
  SELECT satuan FROM products
  UNION
  SELECT satuan FROM product_units
) AS all_satuan
WHERE TRIM(satuan) != ''
GROUP BY UPPER(TRIM(satuan))
HAVING UPPER(TRIM(satuan)) NOT IN (SELECT code FROM units);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`unit_id` integer NOT NULL,
	`jumlah_kemasan` integer NOT NULL,
	`conversion_factor` integer NOT NULL,
	`harga_jual` integer NOT NULL,
	`is_base_unit` integer DEFAULT false NOT NULL,
	`is_default_sales_unit` integer DEFAULT false NOT NULL,
	`is_default_purchase_unit` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
-- Existing (derived) rows keep their id so sale_items/purchase_items.product_unit_id stays valid.
-- unit_id resolves from the old satuan text, conversion_factor from the old cumulative konversi.
-- ponytail: a product holding two derived rows whose satuan differs only by case/whitespace
-- (e.g. 'Dus' + 'DUS' — the old unique index was on raw satuan) collapses to the same unit_id and
-- fails loudly on the unique index below. Not seen in real data; merging them would need a policy
-- for re-pointing sale_items at the surviving row, so it is left to fail inside the transaction.
INSERT INTO `__new_product_units` (`id`, `product_id`, `unit_id`, `jumlah_kemasan`, `conversion_factor`, `harga_jual`, `is_base_unit`, `is_default_sales_unit`, `is_default_purchase_unit`, `created_at`, `updated_at`)
SELECT pu.id, pu.product_id, u.id, pu.jumlah_kemasan, pu.konversi, pu.harga_jual, 0, 0, 0, pu.created_at, pu.updated_at
FROM product_units pu
JOIN units u ON u.code = UPPER(TRIM(pu.satuan));--> statement-breakpoint
-- A derived row may already use the product's own base satuan (the old (product_id, satuan)
-- unique index never prevented it). Promote it instead of inserting a colliding base row,
-- which would violate the new (product_id, unit_id) unique index.
UPDATE `__new_product_units`
SET `is_base_unit` = 1, `is_default_sales_unit` = 1, `is_default_purchase_unit` = 1, `jumlah_kemasan` = 1, `conversion_factor` = 1
WHERE `unit_id` = (
  SELECT u.id FROM products p JOIN units u ON u.code = UPPER(TRIM(p.satuan))
  WHERE p.id = `__new_product_units`.`product_id`
);--> statement-breakpoint
-- One base-unit row per product (conversion_factor = 1), for every product not already covered above.
INSERT INTO `__new_product_units` (`product_id`, `unit_id`, `jumlah_kemasan`, `conversion_factor`, `harga_jual`, `is_base_unit`, `is_default_sales_unit`, `is_default_purchase_unit`, `created_at`, `updated_at`)
SELECT p.id, u.id, 1, 1, p.harga_jual, 1, 1, 1, unixepoch(), unixepoch()
FROM products p
JOIN units u ON u.code = UPPER(TRIM(p.satuan))
WHERE NOT EXISTS (
  SELECT 1 FROM `__new_product_units` n WHERE n.product_id = p.id AND n.unit_id = u.id
);--> statement-breakpoint
DROP TABLE `product_units`;--> statement-breakpoint
ALTER TABLE `__new_product_units` RENAME TO `product_units`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `product_units_product_id_unit_id_unique` ON `product_units` (`product_id`,`unit_id`);--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `satuan`;
