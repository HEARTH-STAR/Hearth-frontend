CREATE TABLE "dots" (
	"dot_id" text PRIMARY KEY NOT NULL,
	"dot_name" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_ins" (
	"sign_in_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"signed_in_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "dots" ADD CONSTRAINT "dots_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_ins" ADD CONSTRAINT "sign_ins_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dots_user_id_idx" ON "dots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sign_ins_user_id_signed_in_at_idx" ON "sign_ins" USING btree ("user_id","signed_in_at");