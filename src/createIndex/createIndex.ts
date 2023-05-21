// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'withEsClie... Remove this comment to see the full error message
import withEsClient from '../withEsClient/withEsClient.js';
import settings from '../analyzers/englishplus.js';

export default async function createIndex(index: any, body = {}) {
  const { result, error } = await withEsClient((client: any) => {
    return client.indices.create({
      index,
      body: {
        ...body,
        settings: {
          ...settings,
          // @ts-expect-error TS(2339): Property 'settings' does not exist on type '{}'.
          ...(body.settings || {}),
        },
      },
    });
  });
  return {
    result: result?.statusCode === 200,
    error,
    details: result || error?.meta,
  };
}
