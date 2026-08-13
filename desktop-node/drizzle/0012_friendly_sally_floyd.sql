ALTER TABLE `product_units` ADD `harga_pokok` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- day one every unit costs exactly base cost x conversion, which is what the app
-- computed implicitly before this column existed - no historical figure moves
UPDATE `product_units`
SET `harga_pokok` = (SELECT `harga_pokok` FROM `products` WHERE `products`.`id` = `product_units`.`product_id`) * `conversion_factor`;--> statement-breakpoint
-- harga_pokok changes meaning here: it used to be the cost of one BASE unit and was
-- multiplied by konversi at read time in rekap.ts. Baking that multiplication in keeps
-- every past sale's profit identical while letting new rows carry a real per-unit cost.
UPDATE `sale_items` SET `harga_pokok` = `harga_pokok` * `konversi`;
