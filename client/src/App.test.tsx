import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App shell', () => {
  it('renders the product name and tagline', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Know Your Code' })).toBeInTheDocument();
    expect(screen.getByText('Understand the code you build.')).toBeInTheDocument();
  });
});
