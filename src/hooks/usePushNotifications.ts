import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/integrations/supabase/client';

export function usePushNotifications(
  userId: string | null | undefined,
  organizationId: string | null | undefined,
) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!userId || !organizationId) return;

    let isMounted = true;

    const saveToken = async (token: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('push_tokens')
        .upsert(
          {
            user_id: userId,
            organization_id: organizationId,
            token,
            platform: 'android',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,token' },
        );
      if (error) {
        console.error('[usePushNotifications] error al guardar el token:', error);
      }
    };

    const registrationListener = PushNotifications.addListener('registration', (token) => {
      if (!isMounted) return;
      void saveToken(token.value);
    });

    const registrationErrorListener = PushNotifications.addListener('registrationError', (error) => {
      console.error('[usePushNotifications] error de registro:', error);
    });

    const pushReceivedListener = PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[usePushNotifications] notificación recibida:', notification);
    });

    const setup = async () => {
      try {
        const permStatus = await PushNotifications.requestPermissions();
        if (permStatus.receive !== 'granted') return;
        await PushNotifications.register();
      } catch (err) {
        console.error('[usePushNotifications] error al inicializar:', err);
      }
    };

    void setup();

    return () => {
      isMounted = false;
      void registrationListener.then((l) => l.remove());
      void registrationErrorListener.then((l) => l.remove());
      void pushReceivedListener.then((l) => l.remove());
    };
  }, [userId, organizationId]);
}
