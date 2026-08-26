export interface LoginCodeEmail {
  subject: string;
  html: string;
  text: string;
}

// Обычный шаблон-строка: письмо из одного абзаца и кода, react-email тут избыточен.
export function loginCodeEmail(code: string): LoginCodeEmail {
  return {
    subject: `Код для входа: ${code}`,
    text: `Ваш код для входа: ${code}\n\nВведите его в приложении. Если вы не запрашивали вход, просто проигнорируйте это письмо.`,
    html: `
      <div style="font-family: sans-serif; font-size: 16px; color: #111;">
        <p>Ваш код для входа:</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${code}</p>
        <p style="color: #666;">Введите его в приложении. Если вы не запрашивали вход, просто проигнорируйте это письмо.</p>
      </div>
    `.trim(),
  };
}
