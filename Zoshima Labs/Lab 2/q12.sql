-- 12. CTE Report

WITH avg_marks AS(
  SELECT course_id, AVG(marks) avg
  FROM exam
  GROUP BY course_id
),
stats AS (
  SELECT e.course_id,
    COUNT(*) total_students,
    SUM(CASE WHEN e.marks > a.avg THEN 1 ELSE 0 END)
  above_avg_count,
    SUM(CASE WHEN e.marks >= 40 THEN 1 ELSE 0 END) passed
  FROM exam e
  JOIN avg_marks a ON e.course_id = a.course_id
  GROUP BY e.course_id
),
result AS (
  SELECT course_id,
    total_students,
    COALESCE(above_avg_count, 0) above_avg_count,
    ROUND(passed*100.0 / total_students, 2) pass_percentage
  FROM stats
)
SELECT *
FROM result
ORDER BY course_id;