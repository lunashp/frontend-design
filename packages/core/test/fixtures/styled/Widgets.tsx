import styled from 'styled-components';
import { css } from '@emotion/react';

// A base whose only declaration is not themeable — nothing to tokenize here.
const Base = styled.button`
  border: none;
`;

// styled.div with static colour / radius / padding / shadow literals: every
// value lies wholly inside the single static quasi, so all four are re-themeable.
export const Card = styled.div`
  background: #7367f0;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
`;

// styled(Component) with an interpolation adjacent to static literals: the
// `padding` value is dynamic (touches `${...}`) and must be skipped, while the
// static `color` and `margin-top` on either side are still tokenized.
export const Toggle = styled(Base)<{ big?: boolean }>`
  color: #7367f0;
  padding: ${(props) => (props.big ? '16px' : '8px')};
  margin-top: 4px;
`;

// An emotion `css` tagged template — same template shape, same treatment.
export const badge = css`
  background: #ede9fe;
  border-radius: 6px;
`;
