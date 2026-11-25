-- 1. College Record Management — SQL Operations

INSERT INTO exam VALUES
(312, 108, 204, 72);
INSERT INTO exam VALUES
(313, 106, 204, 68);

UPDATE exam
SET marks = 75
WHERE student_id = 103 AND course_id = 203;

DELETE FROM exam
WHERE exam_id = 307;