CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorUserId` int NOT NULL,
	`action` varchar(96) NOT NULL,
	`targetType` varchar(64) NOT NULL,
	`targetId` varchar(128),
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `directory_entries` (
	`id` varchar(128) NOT NULL,
	`kind` enum('pharmacy','healthcare') NOT NULL,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`city` varchar(96),
	`name` varchar(255),
	`phone` varchar(40),
	`address` text,
	`latitude` double,
	`longitude` double,
	`dutyGroup` int,
	`establishmentType` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `directory_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_created_idx` ON `audit_logs` (`action`,`createdAt`);--> statement-breakpoint
CREATE INDEX `directory_entries_kind_city_idx` ON `directory_entries` (`kind`,`city`);--> statement-breakpoint
CREATE INDEX `directory_entries_status_idx` ON `directory_entries` (`status`);