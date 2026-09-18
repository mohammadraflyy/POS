CREATE TABLE `sale_cost_corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`sale_id` integer NOT NULL,
	`sale_item_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`nama_item` text NOT NULL,
	`satuan` text NOT NULL,
	`qty` integer NOT NULL,
	`harga_pokok_lama` integer NOT NULL,
	`harga_pokok_baru` integer NOT NULL,
	`user_id` integer NOT NULL,
	`admin_name` text NOT NULL,
	`alasan` text NOT NULL,
	`created_at` integer NOT NULL
);
