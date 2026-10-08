CREATE TABLE `announcements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`city` varchar(96),
	`title` varchar(120) NOT NULL,
	`body` varchar(600) NOT NULL,
	`tone` enum('info','warning','danger') NOT NULL DEFAULT 'info',
	`startsAt` datetime NOT NULL,
	`endsAt` datetime,
	`active` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `announcements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cities` (
	`name` varchar(96) NOT NULL,
	`latitude` double NOT NULL,
	`longitude` double NOT NULL,
	`aliases` text,
	`published` boolean NOT NULL DEFAULT true,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cities_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `insurers` (
	`id` varchar(48) NOT NULL,
	`label` varchar(96) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `insurers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `medicine_category_labels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`level` enum('category','subcategory') NOT NULL,
	`original` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `medicine_category_labels_id` PRIMARY KEY(`id`),
	CONSTRAINT `medicine_category_labels_original_idx` UNIQUE(`level`,`original`)
);
--> statement-breakpoint
CREATE TABLE `medicine_overrides` (
	`id` varchar(160) NOT NULL,
	`data` text NOT NULL,
	`hidden` boolean NOT NULL DEFAULT false,
	`added` boolean NOT NULL DEFAULT false,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `medicine_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `premium_plans` (
	`id` varchar(32) NOT NULL,
	`label` varchar(64) NOT NULL,
	`amount` int NOT NULL,
	`durationDays` int NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `premium_plans_id` PRIMARY KEY(`id`)
);
