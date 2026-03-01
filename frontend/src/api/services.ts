/**
 * API 服务方法
 */
import client from './client';
import type {
  ServiceStatus,
  GeneratePromptRequest,
  GeneratePromptResponse,
  GenerateMediaRequest,
  GenerateMediaResponse,
  UploadImageResponse,
  WorkflowsResponse,
} from '../types/api';

import type { AuthResponse, UserConfig } from '../types/models';

export const apiService = {
  // 用户认证
  register: (data: { username: string; password: string }): Promise<AuthResponse> =>
    client.post('/auth/register', data),
  
  login: (data: { username: string; password: string }): Promise<AuthResponse> =>
    client.post('/auth/login', data),
  
  // 用户配置
  getUserConfig: (): Promise<UserConfig> =>
    client.get('/config/user'),
  
  updateUserConfig: (data: Partial<UserConfig>): Promise<{ message: string }> =>
    client.post('/config/user', data),
  
  resetUserConfig: (): Promise<{ message: string }> =>
    client.delete('/config/user'),
  
  // 会话管理
  getSessions: (): Promise<any[]> =>
    client.get('/chat/sessions'),
  
  createSession: (title?: string): Promise<{ session_id: string; title: string; created_at: number; updated_at: number }> =>
    client.post('/chat/sessions', { session_id: `session-${Date.now()}`, title: title || '新对话' }),
  
  deleteSession: (sessionId: string): Promise<{ message: string }> =>
    client.delete(`/chat/sessions/${sessionId}`),
  
  updateSessionTitle: (sessionId: string, title: string): Promise<{ message: string }> =>
    client.put(`/chat/sessions/${sessionId}`, { title }),
  
  // 会话配置
  getSessionConfig: (sessionId: string): Promise<{
    workflow: string;
    prompt: string;
    lora_prompt: string;
    strength: number;
    count: number;
    images_per_row: number;
    reference_image: string | null;
    prompt_end?: string | null;
    reference_image_end?: string | null;
  }> =>
    client.get(`/chat/sessions/${sessionId}/config`),
  
  updateSessionConfig: (sessionId: string, config: {
    workflow?: string;
    prompt?: string;
    lora_prompt?: string;
    strength?: number;
    count?: number;
    images_per_row?: number;
    reference_image?: string | null;
    prompt_end?: string | null;
    reference_image_end?: string | null;
  }): Promise<{ message: string }> =>
    client.put(`/chat/sessions/${sessionId}/config`, config),
  
  // 聊天历史
  getChatHistory: (limit?: number, sessionId?: string): Promise<{ messages: any[] }> =>
    client.get('/chat/history', { params: { limit, session_id: sessionId } }),
  
  saveChatMessage: (data: {
    session_id: string;
    message_id: string;
    type: 'user' | 'assistant';
    content: string;
    workflow?: string;
    strength?: number;
    count?: number;
    lora_prompt?: string;
    images?: string[];
    reference_image?: string;
    reference_image_end?: string;
  }): Promise<{ message: string }> =>
    client.post('/chat/save', data),
  
  clearChatHistory: (): Promise<{ message: string }> =>
    client.delete('/chat/history'),
  
  // 参考图
  saveReferenceImage: (data: { image: string; filename?: string }): Promise<{ message: string }> =>
    client.post('/reference-image', data),
  
  getReferenceImage: (): Promise<{ image: string | null }> =>
    client.get('/reference-image'),
  
  clearReferenceImage: (): Promise<{ message: string }> =>
    client.delete('/reference-image'),
  
  // 服务状态
  getServiceStatus: (): Promise<ServiceStatus> => 
    client.get('/service/status'),
  
  startService: (): Promise<{ message: string }> => 
    client.post('/service/start'),
  
  stopService: (): Promise<{ message: string }> =>
    client.post('/service/stop'),
  
  // Prompt 生成
  generatePrompt: (data: GeneratePromptRequest): Promise<GeneratePromptResponse> =>
    client.post('/prompt/generate', data),
  
  // 媒体生成
  generateMedia: (data: GenerateMediaRequest): Promise<GenerateMediaResponse> =>
    client.post('/media/generate', data, {
      timeout: 300000 // 5 分钟，因为生成多张图片耗时较长
    }),
  
  // 媒体上传
  uploadImage: (file: File): Promise<UploadImageResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/media/upload-reference', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  
  // 工作流
  getWorkflows: (): Promise<WorkflowsResponse> =>
    client.get('/service/workflows'),

  getWorkflowDefaults: (): Promise<{ success: boolean; defaults: any }> =>
    client.get('/service/workflow/defaults'),

  switchWorkflow: (workflow_type: string): Promise<{ message: string }> =>
    client.post('/service/workflow/switch', null, { params: { workflow_type } }),
  // 预览
  getPreviews: (): Promise<{ previews: any[] }> =>
    client.get('/previews'),
  
  clearPreviews: (): Promise<{ message: string }> =>
    client.delete('/previews'),
};
