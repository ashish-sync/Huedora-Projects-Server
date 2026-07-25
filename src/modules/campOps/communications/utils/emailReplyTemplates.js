export function buildEmailAutoReply({ results = [] } = {}) {
  const created = results.filter((item) => item.status === 'created');
  const lines = [
    'Automated Message – Please Do Not Reply',
    '',
    'Dear Sender,',
    '',
    'Thank you for your camp request. We have successfully received it.',
    '',
    'Our team will review and confirm your request within 24–48 hours. A confirmation message will be sent to the provided number, and assignment details will be shared 24 hours before the camp.',
    '',
    'Note: Details will be verified and updated, if needed, before final confirmation. Requests received on Sundays will be processed on the next working day.',
  ];

  if (created.length) {
    lines.push('', 'Reference:');
    created.forEach((item) => {
      lines.push(`Camp ID: ${item.campId}`);
    });
  }

  if (!created.length) {
    lines.push(
      '',
      'We could not fully process the camp details in your email. Our team will still review your message manually.',
    );
  }

  lines.push('', 'Thank you for your patience.');

  return lines.join('\n');
}

export function buildWhatsAppAutoReply({ results = [] } = {}) {
  return buildEmailAutoReply({ results });
}
