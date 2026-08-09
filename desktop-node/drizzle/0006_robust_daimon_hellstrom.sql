CREATE TABLE `units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_code_unique` ON `units` (`code`);
--> statement-breakpoint
INSERT INTO units (code, name, symbol, is_active, created_at, updated_at)
SELECT UPPER(TRIM(satuan)), MIN(TRIM(satuan)), LOWER(MIN(TRIM(satuan))), 1, unixepoch(), unixepoch()
FROM (
  SELECT satuan FROM products
  UNION
  SELECT satuan FROM product_units
) AS all_satuan
WHERE TRIM(satuan) != ''
GROUP BY UPPER(TRIM(satuan))
HAVING UPPER(TRIM(satuan)) NOT IN (SELECT code FROM units);