-- Seed data for the ArmorIQ Postgres cookbook demo.
-- Deliberately includes a "salary" column so the demo has a realistic reason
-- to gate SQL access with a policy hold rather than a blanket allow.

CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    salary NUMERIC(10, 2) NOT NULL
);

INSERT INTO employees (name, department, salary) VALUES
    ('Isha Parekh', 'Engineering', 145000.00),
    ('Rohan Iyer', 'Engineering', 138000.00),
    ('Priya Shah', 'Sales', 92000.00),
    ('Arjun Mehta', 'Sales', 98000.00),
    ('Divya Rao', 'Support', 68000.00)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO notes (title, body) VALUES
    ('Welcome', 'This is a seeded note for the ArmorIQ Postgres cookbook demo.')
ON CONFLICT DO NOTHING;
