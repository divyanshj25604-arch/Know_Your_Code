-- Value references (a function passed as an argument, used as a JSX element, exported) are recorded as a
-- distinct, verified edge type so "who uses this?" is not limited to direct calls.
ALTER TABLE edges DROP CONSTRAINT edges_type_check;
ALTER TABLE edges ADD CONSTRAINT edges_type_check CHECK (type IN ('imports','calls','references','route_handler'));
