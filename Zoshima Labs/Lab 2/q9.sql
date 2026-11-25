-- 9. Views

CREATE VIEW course_report AS
SELECT
  c.course_id,
  c.course_name,
  ROUND(AVG(e.marks), 2) AS average_marks
FROM course c
JOIN exam e ON c.course_id = e.course_id
GROUP BY c.course_id, c.course_name;