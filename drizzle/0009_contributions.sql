CREATE TABLE `contributions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('new_place','problem') NOT NULL,
	`status` enum('new','accepted','rejected','resolved') NOT NULL DEFAULT 'new',
	`userId` int,
	`city` varchar(96),
	`placeKind` enum('pharmacy','healthcare'),
	`placeId` varchar(128),
	`name` varchar(255),
	`phone` varchar(40),
	`address` text,
	`latitude` double,
	`longitude` double,
	`openingHours` text,
	`category` varchar(96),
	`subject` varchar(255),
	`message` text,
	`adminNote` text,
	`handledBy` int,
	`handledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contributions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `suspendedAt` timestamp;--> statement-breakpoint
CREATE INDEX `contributions_status_kind_idx` ON `contributions` (`status`,`kind`,`createdAt`);