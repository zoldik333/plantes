CREATE TABLE `care_sheet_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`plant_id` text NOT NULL,
	`household_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `care_sheet_jobs_plant_id_unique` ON `care_sheet_jobs` (`plant_id`);