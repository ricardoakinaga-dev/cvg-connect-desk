import axios from 'axios';

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8082';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'evolution_cvg_2026';
const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE || 'cvg-desk';

/**
 * Serviço de mídia para Evolution API.
 * Envia imagens, áudios e documentos via WhatsApp.
 */
export const mediaService = {
  /**
   * Envia mensagem de texto via Evolution API.
   */
  async sendText(phone: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const jid = `${phone}@s.whatsapp.net`;
      const response = await axios.post(
        `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`,
        {
          number: jid,
          text,
        },
        {
          headers: { apikey: EVOLUTION_API_KEY },
          timeout: 15000,
        }
      );
      return { success: true, messageId: response.data?.key?.id };
    } catch (error: any) {
      console.error('[mediaService] Erro ao enviar texto:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Envia imagem via Evolution API.
   * @param phone - Número do telefone (ex: "5511999999999")
   * @param imageUrl - URL da imagem ou base64
   * @param caption - Legenda opcional
   */
  async sendImage(phone: string, imageUrl: string, caption?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const jid = `${phone}@s.whatsapp.net`;

      // Se for base64, converter para formato correto
      let medias: any;
      if (imageUrl.startsWith('data:')) {
        medias = {
          medias: [
            {
              mediatype: 'image',
              media: imageUrl,
              caption: caption || '',
            },
          ],
        };
      } else {
        medias = {
          medias: [
            {
              mediatype: 'image',
              media: imageUrl,
              caption: caption || '',
            },
          ],
        };
      }

      const response = await axios.post(
        `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`,
        {
          number: jid,
          ...medias,
        },
        {
          headers: { apikey: EVOLUTION_API_KEY },
          timeout: 30000,
        }
      );
      return { success: true, messageId: response.data?.key?.id };
    } catch (error: any) {
      console.error('[mediaService] Erro ao enviar imagem:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Envia áudio via Evolution API.
   * @param phone - Número do telefone
   * @param audioUrl - URL do áudio ou base64
   */
  async sendAudio(phone: string, audioUrl: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const jid = `${phone}@s.whatsapp.net`;

      const response = await axios.post(
        `${EVOLUTION_URL}/message/sendWhatsAppAudio/${INSTANCE_NAME}`,
        {
          number: jid,
          audio: audioUrl,
          delay: 1200,
        },
        {
          headers: { apikey: EVOLUTION_API_KEY },
          timeout: 30000,
        }
      );
      return { success: true, messageId: response.data?.key?.id };
    } catch (error: any) {
      console.error('[mediaService] Erro ao enviar áudio:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Envia documento via Evolution API.
   */
  async sendDocument(phone: string, documentUrl: string, filename?: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const jid = `${phone}@s.whatsapp.net`;

      const response = await axios.post(
        `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`,
        {
          number: jid,
          mediatype: 'document',
          media: documentUrl,
          fileName: filename || 'documento',
        },
        {
          headers: { apikey: EVOLUTION_API_KEY },
          timeout: 30000,
        }
      );
      return { success: true, messageId: response.data?.key?.id };
    } catch (error: any) {
      console.error('[mediaService] Erro ao enviar documento:', error.message);
      return { success: false, error: error.message };
    }
  },

  /**
   * Baixa mídia do WhatsApp via Evolution API.
   * @param messageId - ID da mensagem no WhatsApp
   */
  async downloadMedia(messageId: string): Promise<{ success: boolean; base64?: string; mimetype?: string; error?: string }> {
    try {
      const response = await axios.post(
        `${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${INSTANCE_NAME}`,
        {
          message: {
            key: { id: messageId },
          },
        },
        {
          headers: { apikey: EVOLUTION_API_KEY },
          timeout: 30000,
        }
      );

      return {
        success: true,
        base64: response.data?.base64,
        mimetype: response.data?.mimetype,
      };
    } catch (error: any) {
      console.error('[mediaService] Erro ao baixar mídia:', error.message);
      return { success: false, error: error.message };
    }
  },
};
