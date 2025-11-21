import axios from 'axios';
import { getTutorConfig, DEFAULT_COURSE_IDS } from '../config/index.js';

export async function enrollUserToCourses(userId) {
  const { apiUrl, buildHeaders } = getTutorConfig();
  if (!apiUrl || !userId) {
    return { added: 0, failed: 0 };
  }
  
  const trimmedApi = apiUrl.replace(/\/$/, '');
  const enrollUrl = `${trimmedApi}/enrollments`;
  
  if (!/^https?:\/\//i.test(enrollUrl)) {
    console.error('[Tutor] invalid TUTOR_API_URL (missing http/https)', { apiUrl });
    return { added: 0, failed: 0 };
  }
  
  const summary = { added: 0, failed: 0 };
  
  console.log('[Tutor] enroll start', { userId, enrollUrl, courses: DEFAULT_COURSE_IDS.length });
  
  for (const courseId of DEFAULT_COURSE_IDS) {
    try {
      const payload = { user_id: userId, course_id: courseId };
      const response = await axios.post(enrollUrl, payload, { 
        headers: buildHeaders(), 
        validateStatus: () => true 
      });
      
      const bodyPreview = typeof response.data === 'string' 
        ? response.data.slice(0, 200) 
        : JSON.stringify(response.data).slice(0, 200);
      
      console.log('[Tutor] enroll response', { courseId, status: response.status, body: bodyPreview });
      
      if ((response.status >= 200 && response.status < 300) || response.status === 409) {
        summary.added++;
      } else {
        summary.failed++;
        console.error('[Tutor] enroll failed', { userId, courseId, status: response.status });
      }
    } catch (error) {
      summary.failed++;
      console.error('[Tutor] enroll exception', userId, courseId, error.message);
    }
  }
  
  return summary;
}

