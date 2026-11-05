CREATE TABLE IF NOT EXISTS crm_owner_admin_access (
 user_id CHAR(36) PRIMARY KEY,
 authorized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 completed_at DATETIME(3) NULL,
 CONSTRAINT crm_owner_admin_user_fk FOREIGN KEY (user_id) REFERENCES crm_users(id)
) ENGINE=InnoDB;
