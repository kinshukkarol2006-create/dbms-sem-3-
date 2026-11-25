-- 11. Window Function

SELECT
  course_id,
  student_id,
  marks,
  RANK() OVER (
    PARTITION BY course_id
    ORDER BY marks DESC
  ) AS course_rank
FROM exam
ORDER BY course_id, course_rank, student_id;