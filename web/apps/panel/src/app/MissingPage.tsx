import { Card, CardBody, Hint } from '@isle/ui';

/** An address with no page (an old bookmark, a page this login may not see): said so, inside the block frame. */
export function MissingPage({ title }: { title: string }) {
  return (
    <Card>
      <CardBody stack>
        <Hint><b>{title}</b>: không có trang này, hoặc tài khoản của bạn không được xem. Chọn một mục ở trên hoặc ở thanh bên.</Hint>
      </CardBody>
    </Card>
  );
}
