CREATE TABLE `cash_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`tanggal` text NOT NULL,
	`kategori` text NOT NULL,
	`jumlah` integer NOT NULL,
	`keterangan` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
